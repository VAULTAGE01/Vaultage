import React from 'react'
import ReactDOM from 'react-dom/client'
import { VaultProvider } from './vaultContext'
import App from './App'
import SecureInputBridge from './components/SecureInputBridge'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <VaultProvider>
      <SecureInputBridge />
      <App />
    </VaultProvider>
  </React.StrictMode>
)
