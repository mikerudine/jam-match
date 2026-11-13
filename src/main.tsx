import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import {
  consumeTgAuthResultFromLocation,
  setPendingTelegramWidgetUser,
} from './auth/telegramWidgetAuth'
import './index.css'

// Strip #tgAuthResult=… before HashRouter mounts — otherwise the * route
// swallows the only auth path on iOS Safari / Telegram in-app browser.
const tgRedirectUser = consumeTgAuthResultFromLocation()
if (tgRedirectUser) {
  setPendingTelegramWidgetUser(tgRedirectUser)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
