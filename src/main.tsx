import * as Sentry from "@sentry/react";
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

Sentry.init({
  dsn: "https://YOUR_SENTRY_DSN", // leave empty string "" to disable
  tracesSampleRate: 0.2,
  replaysSessionSampleRate: 0.1,
});

createRoot(document.getElementById("root")!).render(<App />);
