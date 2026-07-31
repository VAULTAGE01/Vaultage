import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import SecureInputBridge from './components/SecureInputBridge'
import { TextInputDialogProvider } from './components/TextInputDialogProvider'
import { VaultProvider } from './vaultContext'
import './index.css'

const container = document.getElementById('root')
if (!container) throw new Error('Renderer root is unavailable')

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <TextInputDialogProvider>
      <VaultProvider>
        <SecureInputBridge />
        <App />
      </VaultProvider>
    </TextInputDialogProvider>
  </React.StrictMode>,
)
