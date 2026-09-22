import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { LabApp } from './App'

document.title = 'Once Upon lab'

const root = document.getElementById('lab')
if (!root) throw new Error('#lab missing')
createRoot(root).render(
  <StrictMode>
    <LabApp />
  </StrictMode>
)
