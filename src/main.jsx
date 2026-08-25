import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// Resolve and apply <html data-theme> before first paint (issue #81) —
// importing ahead of the app render prevents a dark flash for light /
// high-contrast users.
import './utils/theme'
import App from './App.jsx'
import EmbedApp from './components/EmbedApp.jsx'

// /embed serves a chrome-free widget view of the same visualizers (issue #108)
// for use inside <iframe> snippets; everything else is the full app.
const isEmbed = window.location.pathname === '/embed' || window.location.pathname === '/embed/'

// Machine-readable shell marker (#795): /, /embed and compare.html render
// different DOM shells over the same URL-param vocabulary, so agents can read
// `html[data-app-shell]` ("main" | "embed" | "compare") before selecting —
// e.g. #view-select/#hw-preset exist only under "main".
document.documentElement.dataset.appShell = isEmbed ? 'embed' : 'main'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isEmbed ? <EmbedApp /> : <App />}
  </StrictMode>,
)
