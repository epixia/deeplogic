// Browser-side Supabase client.
// Reads config from Vite env (VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY).
// Persists the session in localStorage and auto-refreshes the JWT so the
// access token handed to lib/api.ts stays valid.

import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!url || !anonKey) {
  // Surface a clear error during dev rather than failing deep inside the client.
  // eslint-disable-next-line no-console
  console.error(
    'Missing Supabase env: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in client/.env',
  )
}

export const supabase = createClient(url ?? '', anonKey ?? '', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'dl-auth',
  },
})
