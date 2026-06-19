import React from 'react'
import ReactDOM from 'react-dom/client'
import 'pretendard/dist/web/variable/pretendardvariable.css'
import App from './App'
import './styles.css'
import { initTheme } from './lib/theme'

// Apply the persisted theme before React paints, so launching on a non-default
// theme doesn't flash the default palette first.
initTheme()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
