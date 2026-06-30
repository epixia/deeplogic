// Browser-side Supabase client.
// Reads config from Vite env (VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY).
// Persists the session in localStorage and auto-refreshes the JWT so the
// access token handed to lib/api.ts stays valid.

import { createClient } from '@supabase/supabase-js'

const envUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!envUrl || !anonKey) {
  // Surface a clear error during dev rather than failing deep inside the client.
  // eslint-disable-next-line no-console
  console.error(
    'Missing Supabase env: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in client/.env',
  )
}

// In dev, route Supabase through the Vite `/sb` proxy so it's SAME-ORIGIN as the
// app (no CORS). Local Supabase sends `Access-Control-Allow-Origin: *` with
// `Allow-Credentials: true`, which browsers reject for credentialed requests
// (password reset/update). Production uses the real, CORS-correct Supabase URL.
const url = import.meta.env.DEV && typeof window !== 'undefined'
  ? `${window.location.origin}/sb`
  : (envUrl ?? '')

export const supabase = createClient(url, anonKey ?? '', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'dl-auth',
  },
})
