import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import ComparePage from './ComparePage.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ComparePage />
  </StrictMode>,
)
