/** Shared shape for explicit or suggested jam windows. */
export interface JamWhenSuggestion {
  window_start: string | null | undefined
  window_end: string | null | undefined
  suggested_window_start?: string | null
  suggested_window_end?: string | null
  suggested_match_count?: number | null
  suggested_participant_count?: number | null
  suggested_matched_names?: string[] | null
}

export interface ResolvedJamWhen {
  start: string
  end: string
  suggested: boolean
  matchCount: number | null
  participantCount: number | null
  matchedNames: string[]
}

export function resolveJamWhen(jam: JamWhenSuggestion): ResolvedJamWhen | null {
  if (jam.window_start && jam.window_end) {
    return {
      start: jam.window_start,
      end: jam.window_end,
      suggested: false,
      matchCount: null,
      participantCount: null,
      matchedNames: [],
    }
  }
  if (jam.suggested_window_start && jam.suggested_window_end) {
    const names = Array.isArray(jam.suggested_matched_names)
      ? jam.suggested_matched_names
      : []
    return {
      start: jam.suggested_window_start,
      end: jam.suggested_window_end,
      suggested: true,
      matchCount: jam.suggested_match_count ?? null,
      participantCount: jam.suggested_participant_count ?? null,
      matchedNames: names,
    }
  }
  return null
}

export function formatJamWhenRange(
  startIso: string,
  endIso: string,
  locale: string,
): string {
  const start = new Date(startIso)
  const end = new Date(endIso)
  const loc = locale === 'uk' ? 'uk-UA' : 'en-GB'
  const day = start.toLocaleString(loc, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
  const endTime = end.toLocaleTimeString(loc, {
    hour: '2-digit',
    minute: '2-digit',
  })
  return `${day} – ${endTime}`
}

export function formatJamWhenLabel(
  jam: JamWhenSuggestion,
  locale: string,
  strings: {
    noDate: string
    suggestedSuffix: string
    partialSuffix: string
  },
): string {
  const resolved = resolveJamWhen(jam)
  if (!resolved) return strings.noDate
  const range = formatJamWhenRange(resolved.start, resolved.end, locale)
  if (!resolved.suggested) return range
  const partial =
    resolved.matchCount != null &&
    resolved.participantCount != null &&
    resolved.matchCount < resolved.participantCount
  if (partial) {
    return `${range} · ${strings.partialSuffix
      .replace('{n}', String(resolved.matchCount))
      .replace('{total}', String(resolved.participantCount))}`
  }
  return `${range} · ${strings.suggestedSuffix}`
}
