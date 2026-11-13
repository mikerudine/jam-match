import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import {
  consumeTgAuthResultFromLocation,
  setPendingTelegramWidgetUser,
} from './auth/telegramWidgetAuth'
import { capturePendingJamFromStartParam } from './lib/telegramDeepLink'
import './index.css'

// Strip #tgAuthResult=… before HashRouter mounts — otherwise the * route
// swallows the only auth path on iOS Safari / Telegram in-app browser.
const tgRedirectUser = consumeTgAuthResultFromLocation()
if (tgRedirectUser) {
  setPendingTelegramWidgetUser(tgRedirectUser)
}

// Direct Mini App links (t.me/<bot>/jam?startapp=jam_<id>) expose start_param
// via initDataUnsafe or tgWebAppStartParam — capture before routing.
capturePendingJamFromStartParam()

// Notify Telegram early so initData auto-login still works on startapp launches.
const webApp = window.Telegram?.WebApp
if (webApp?.initData) {
  webApp.ready()
  webApp.expand?.()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
