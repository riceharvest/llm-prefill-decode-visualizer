import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
// Resolve and apply <html data-theme> before first paint (issue #1002) so
// /compare/* routes carry the same resolved theme as the app routes instead
// of falling back to the :root dark default for light / high-contrast users.
import '../utils/theme'
import ComparePage from './ComparePage.jsx'

// Machine-readable shell marker (#795): lets agents detect the compare shell
// (html[data-app-shell="compare"]) before selecting — this page shares the
// URL-param vocabulary with / and /embed but renders a different DOM.
document.documentElement.dataset.appShell = 'compare'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ComparePage />
  </StrictMode>,
)
