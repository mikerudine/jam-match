import { useEffect, useRef } from 'react'
import {
  HashRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import { acceptFriendInvite } from '@/api/friends'
import { AuthProvider, useAuth } from '@/auth/AuthContext'
import { Layout } from '@/components/Layout'
import { Loading } from '@/components/Loading'
import { SetupScreen } from '@/components/SetupScreen'
import { LocaleProvider, useLocale } from '@/i18n/LocaleContext'
import {
  decodeFriendStartParam,
  decodeJamStartParam,
  readTelegramStartParam,
  takePendingFriendFromStartParam,
  takePendingJamFromStartParam,
} from '@/lib/telegramDeepLink'
import { AvailabilityPage } from '@/pages/AvailabilityPage'
import { EditJamPreviewPage } from '@/pages/EditJamPreviewPage'
import { HomePage } from '@/pages/HomePage'
import { JoinRequestPreviewPage } from '@/pages/JoinRequestPreviewPage'
import { InboxPage } from '@/pages/InboxPage'
import { JamDetailPage } from '@/pages/JamDetailPage'
import { NewJamPage } from '@/pages/NewJamPage'
import { ProfilePage } from '@/pages/ProfilePage'
import { PublicJamPreviewPage } from '@/pages/PublicJamPreviewPage'
import { SignInPage } from '@/pages/SignInPage'
import { SongListPreviewPage } from '@/pages/SongListPreviewPage'

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

/** Accept friend invite from start_param=fr_<uuid>, then open profile. */
function FriendInviteHandler() {
  const { session } = useAuth()
  const { t } = useLocale()
  const navigate = useNavigate()
  const done = useRef(false)

  useEffect(() => {
    if (!session || done.current) return
    const inviterId =
      takePendingFriendFromStartParam() ??
      decodeFriendStartParam(readTelegramStartParam())
    if (!inviterId) return
    done.current = true

    if (inviterId === session.user.id) {
      navigate('/profile', { replace: true })
      return
    }

    ;(async () => {
      try {
        await acceptFriendInvite(inviterId)
        navigate('/profile', {
          replace: true,
          state: { friendBanner: t.friends.accepted },
        })
      } catch (err) {
        navigate('/profile', {
          replace: true,
          state: {
            friendBanner:
              err instanceof Error ? err.message : t.common.error,
          },
        })
      }
    })()
  }, [session, navigate, t.friends.accepted, t.common.error])

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
      <FriendInviteHandler />
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

function AppRoutes() {
  const location = useLocation()
  if (import.meta.env.DEV && location.pathname === '/dev/song-list-preview') {
    return <SongListPreviewPage />
  }
  if (import.meta.env.DEV && location.pathname === '/dev/edit-jam-preview') {
    return <EditJamPreviewPage />
  }
  if (import.meta.env.DEV && location.pathname === '/dev/join-request-preview') {
    return <JoinRequestPreviewPage />
  }
  if (import.meta.env.DEV && location.pathname === '/dev/public-jam-preview') {
    return <PublicJamPreviewPage />
  }
  return <ProtectedRoutes />
}

export default function App() {
  return (
    <LocaleProvider>
      <AuthProvider>
        <HashRouter>
          <AppRoutes />
        </HashRouter>
      </AuthProvider>
    </LocaleProvider>
  )
}
