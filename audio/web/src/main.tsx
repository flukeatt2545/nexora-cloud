import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Redesign from './Redesign'
import './redesign.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Redesign />
  </StrictMode>,
)
