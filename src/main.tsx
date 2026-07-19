import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// NOTE: intentionally NOT wrapped in <StrictMode>. StrictMode double-invokes
// effects in dev, which for our real-time audio + WebSocket lifecycle tears
// down and re-creates the Live session on mount — racing the async connect and
// leaving an orphaned session that keeps billing. One mount, one session.
createRoot(document.getElementById('root')!).render(<App />);
