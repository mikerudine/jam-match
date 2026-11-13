import { useLocale } from '@/i18n/LocaleContext'

export function SetupScreen() {
  const { t, locale, setLocale } = useLocale()

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-5 py-10">
      <div className="anim-rise">
        <p className="font-display text-4xl font-extrabold text-cream">{t.brand}</p>
        <p className="mt-2 text-mute">{t.tagline}</p>
      </div>
      <div className="mt-8 rounded-2xl border border-line bg-panel/90 p-5 anim-rise-delay">
        <h1 className="font-display text-2xl text-amber">{t.setup.title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-cream/90">{t.setup.body}</p>
        <p className="mt-4 rounded-xl bg-panel-2 px-3 py-3 font-mono text-xs text-teal">
          {t.setup.hint}
        </p>
        <pre className="mt-4 overflow-x-auto rounded-xl border border-line bg-ink px-3 py-3 text-xs text-mute">
{`VITE_SUPABASE_URL=https://maqdxmetyzpyupivyecz.supabase.co
VITE_SUPABASE_ANON_KEY=...
# schema jam must be in Exposed schemas`}
        </pre>
      </div>
      <div className="mt-6 flex gap-2">
        {(['uk', 'en'] as const).map((code) => (
          <button
            key={code}
            type="button"
            onClick={() => setLocale(code)}
            className={`rounded-full px-3 py-1.5 text-xs ${
              locale === code ? 'bg-amber text-ink' : 'border border-line text-mute'
            }`}
          >
            {code.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  )
}
