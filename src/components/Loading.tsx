import { useLocale } from '@/i18n/LocaleContext'

export function Loading() {
  const { t } = useLocale()
  return (
    <div className="flex items-center justify-center py-16 text-mute">
      <span className="animate-[pulse-soft_1.4s_ease-in-out_infinite]">
        {t.common.loading}
      </span>
    </div>
  )
}
