import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/base.css'
import './styles/layout.css'
import './styles/shelf.css'
import './styles/editor.css'
import './styles/pdf.css'
import './styles/epub.css'
import './styles/settings.css'

const container = document.getElementById('root')
if (!container) throw new Error('#root 缺失')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
