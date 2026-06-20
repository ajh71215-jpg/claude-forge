import React from 'react'
import ReactDOM from 'react-dom/client'
import 'pretendard/dist/web/variable/pretendardvariable.css'
// Bundle JetBrains Mono (latin) so monospace/code/tool-result text renders in
// JetBrains Mono regardless of what the OS has installed — otherwise the font
// stack would silently fall back to the OS default monospace.
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-500.css'
import '@fontsource/jetbrains-mono/latin-600.css'
import '@fontsource/jetbrains-mono/latin-700.css'
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
