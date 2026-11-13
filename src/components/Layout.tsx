import { NavLink, Outlet } from 'react-router-dom'
import { useLocale } from '@/i18n/LocaleContext'
import { cn } from '@/lib/utils'

export function Layout() {
  const { t, locale, setLocale } = useLocale()

  const links = [
    { to: '/', label: t.nav.home, end: true },
    { to: '/inbox', label: t.nav.inbox },
    { to: '/availability', label: t.nav.availability },
    { to: '/profile', label: t.nav.profile },
  ]

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col px-4 pb-24 pt-5">
      <header className="mb-5 flex items-start justify-between gap-3 anim-rise">
        <div>
          <p className="font-display text-3xl font-extrabold tracking-tight text-cream">
            {t.brand}
          </p>
          <p className="mt-1 text-sm text-mute">{t.tagline}</p>
        </div>
        <div className="flex rounded-full border border-line bg-panel/80 p-1 text-xs">
          {(['uk', 'en'] as const).map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => setLocale(code)}
              className={cn(
                'rounded-full px-2.5 py-1 transition',
                locale === code
                  ? 'bg-amber text-ink'
                  : 'text-mute hover:text-cream',
              )}
            >
              {code.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      <main className="flex-1 anim-rise-delay">
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line/80 bg-ink/90 backdrop-blur-md safe-pb">
        <div className="mx-auto grid max-w-lg grid-cols-4 gap-1 px-2 pt-2">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) =>
                cn(
                  'rounded-xl px-2 py-2 text-center text-xs font-medium transition',
                  isActive
                    ? 'bg-panel-2 text-amber'
                    : 'text-mute hover:text-cream',
                )
              }
            >
              {link.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
