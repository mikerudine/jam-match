import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { supabaseConfig, supabaseConfigured } from './config'

/** All Jam Match tables/RPCs live in Postgres schema `jam` (not public). */
export const DB_SCHEMA = 'jam' as const

// Schema generic is the third type param on supabase-js v2.
type JamClient = SupabaseClient<any, 'public', typeof DB_SCHEMA>

let client: JamClient | null = null

export function getSupabase(): JamClient {
  if (!supabaseConfigured) {
    throw new Error('Supabase is not configured')
  }
  if (!client) {
    client = createClient(supabaseConfig.url, supabaseConfig.anonKey, {
      db: { schema: DB_SCHEMA },
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  }
  return client
}
