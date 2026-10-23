import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initMonitoring } from './lib/monitoring'

// Error tracking first, so a crash while the app boots is reported too. A
// no-op unless this is a production build with a DSN (src/lib/monitoring.ts).
initMonitoring()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
