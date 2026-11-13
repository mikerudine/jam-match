import { useEffect, useRef } from 'react'
import {
  HashRouter,
  Navigate,
  Route,
  Routes,
  useNavigate,
} from 'react-router-dom'
import { AuthProvider, useAuth } from '@/auth/AuthContext'
import { Layout } from '@/components/Layout'
import { Loading } from '@/components/Loading'
import { SetupScreen } from '@/components/SetupScreen'
import { LocaleProvider } from '@/i18n/LocaleContext'
import {
  decodeJamStartParam,
  readTelegramStartParam,
  takePendingJamFromStartParam,
} from '@/lib/telegramDeepLink'
import { AvailabilityPage } from '@/pages/AvailabilityPage'
import { HomePage } from '@/pages/HomePage'
import { InboxPage } from '@/pages/InboxPage'
import { JamDetailPage } from '@/pages/JamDetailPage'
import { NewJamPage } from '@/pages/NewJamPage'
import { ProfilePage } from '@/pages/ProfilePage'
import { SignInPage } from '@/pages/SignInPage'

/** After Mini App auto-login (or existing session), open jam from start_param. */
function StartParamRedirect() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const done = useRef(false)

  useEffect(() => {
    if (!session || done.current) return
    const jamId =
      takePendingJamFromStartParam() ??
      decodeJamStartParam(readTelegramStartParam())
    if (!jamId) return
    done.current = true
    navigate(`/jams/${jamId}`, { replace: true })
  }, [session, navigate])

  return null
}

function ProtectedRoutes() {
  const { session, loading, configured } = useAuth()

  if (!configured) return <SetupScreen />
  if (loading) return <Loading />
  if (!session) return <SignInPage />

  return (
    <>
      <StartParamRedirect />
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="inbox" element={<InboxPage />} />
          <Route path="availability" element={<AvailabilityPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="jams/new" element={<NewJamPage />} />
          <Route path="jams/:jamId" element={<JamDetailPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}

export default function App() {
  return (
    <LocaleProvider>
      <AuthProvider>
        <HashRouter>
          <ProtectedRoutes />
        </HashRouter>
      </AuthProvider>
    </LocaleProvider>
  )
}
