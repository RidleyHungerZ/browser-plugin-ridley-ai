import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/tokens.css'
import './styles/base.css'

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('missing #root')

createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
