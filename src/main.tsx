import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { engine } from './audio/engine';
import { useStore } from './state/store';
import { setupPersistence } from './state/persist';
import './styles.css';

setupPersistence();

engine.attach({
  getProject: () => useStore.getState().project,
  getTransport: () => {
    const { ui } = useStore.getState();
    return { mode: ui.mode, patternId: ui.selectedPatternId, songStart: ui.songStart, metronome: ui.metronome };
  },
});
useStore.subscribe((state, prev) => {
  if (state.project !== prev.project) engine.sync(state.project);
});

// Browsers only allow audio to start from a user gesture.
const unlock = () => {
  engine.ensureRunning();
  window.removeEventListener('pointerdown', unlock, true);
  window.removeEventListener('keydown', unlock, true);
};
window.addEventListener('pointerdown', unlock, true);
window.addEventListener('keydown', unlock, true);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
