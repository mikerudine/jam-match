export type Instrument = 'drums' | 'bass' | 'guitar' | 'keys' | 'vocals' | 'other'
export type Level = 'beginner' | 'intermediate' | 'advanced'
export type JamFormat = 'free_jam' | 'cover_practice' | 'permanent_band'
export type JamStatus = 'matching' | 'confirmed' | 'cancelled' | 'completed'
export type SeatStatus = 'open' | 'invited' | 'filled'
export type InviteStatus = 'pending' | 'accepted' | 'skipped' | 'expired'
export type JoinRequestStatus = 'pending' | 'accepted' | 'declined'
export type Locale = 'uk' | 'en'

export const INSTRUMENTS: Instrument[] = [
  'drums',
  'bass',
  'guitar',
  'keys',
  'vocals',
  'other',
]

export const LEVELS: Level[] = ['beginner', 'intermediate', 'advanced']

export const JAM_FORMATS: JamFormat[] = [
  'free_jam',
  'cover_practice',
  'permanent_band',
]

export const GENRE_OPTIONS = [
  'rock',
  'indie',
  'punk',
  'metal',
  'jazz',
  'blues',
  'funk',
  'soul',
  'electronic',
  'folk',
  'pop',
  'hiphop',
  'experimental',
] as const

export const AREA_OPTIONS = [
  'Podil',
  'Kontraktova',
  'Vokzalna',
  'Lukianivka',
  'Center',
  'Other Kyiv',
] as const

/** Weekly grid: Mon=0 … Sun=6, hours 10–22 inclusive. */
export const AVAIL_DAYS = 7
export const AVAIL_HOUR_START = 10
export const AVAIL_HOUR_END = 22

export interface Profile {
  id: string
  display_name: string
  telegram_handle: string | null
  telegram_id: number | null
  telegram_first_name: string | null
  telegram_last_name: string | null
  telegram_photo_url: string | null
  instruments: Instrument[]
  genres: string[]
  level: Level
  preferred_areas: string[]
  demo_url: string | null
  reliability_score: number
  reliability_count: number
  locale: Locale
  created_at: string
  updated_at: string
}

export interface AvailabilitySlot {
  id?: string
  user_id: string
  day_of_week: number
  hour: number
}

export interface JamRequest {
  id: string
  creator_id: string
  format: JamFormat
  genres: string[]
  area: string
  base_name: string | null
  window_start: string
  window_end: string
  status: JamStatus
  invite_ttl_hours: number
  created_at: string
}

export interface JamSeat {
  id: string
  jam_id: string
  role: Instrument
  /** Freeform label when role is other (e.g. maracas). */
  role_label: string | null
  filled_by: string | null
  is_creator: boolean
  status: SeatStatus
  sort_order: number
}

export interface JamJoinRequest {
  id: string
  jam_id: string
  requester_id: string
  role: string
  note: string | null
  status: JoinRequestStatus
  seat_id: string | null
  created_at: string
  responded_at: string | null
}

export interface JamInvite {
  id: string
  jam_id: string
  seat_id: string
  invitee_id: string
  status: InviteStatus
  expires_at: string
  created_at: string
}

export interface JamFeedback {
  id: string
  jam_id: string
  from_user_id: string
  rating: number
  everyone_showed_up: boolean
  created_at: string
}

export interface InboxInvite extends JamInvite {
  jam: JamRequest
  seat: JamSeat
  creator?: Pick<Profile, 'id' | 'display_name' | 'telegram_handle'>
}

export interface ConfirmedMember {
  seat_id: string
  role: Instrument
  profile: Pick<
    Profile,
    'id' | 'display_name' | 'telegram_handle' | 'instruments' | 'demo_url'
  >
}
