import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

// Only load and initialize Sentry in production with a valid DSN
// Using dynamic import to prevent loading Sentry library in development
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN || "";
if (SENTRY_DSN && import.meta.env.PROD) {
  import('@sentry/react').then((Sentry) => {
    Sentry.init({
      dsn: SENTRY_DSN,
      tracesSampleRate: 0.2,
      replaysSessionSampleRate: 0.1,
    });
  });
}

createRoot(document.getElementById("root")!).render(<App />);
