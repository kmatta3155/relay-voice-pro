import * as Sentry from "@sentry/react";
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

Sentry.init({
  dsn: "", // Sentry disabled in development - set a valid DSN in production
  tracesSampleRate: 0.2,
  replaysSessionSampleRate: 0.1,
});

createRoot(document.getElementById("root")!).render(<App />);
