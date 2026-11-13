import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { supabaseConfig, supabaseConfigured } from './config'

let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (!supabaseConfigured) {
    throw new Error('Supabase is not configured')
  }
  if (!client) {
    client = createClient(supabaseConfig.url, supabaseConfig.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  }
  return client
}
