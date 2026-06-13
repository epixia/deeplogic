// AuthProvider + useAuth() — the single source of truth for session, the signed
// in user, and the orgs they belong to. Wraps @supabase/supabase-js for
// email+password auth and surfaces org memberships via our API's GET /api/me.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { getMe, type OrgMembership } from '../lib/api'

export interface AuthUser {
  id: string
  email: string
}

export interface AuthContextValue {
  user: AuthUser | null
  session: Session | null
  loading: boolean
  orgs: OrgMembership[]
  refreshOrgs: () => Promise<void>
  signIn: (email: string, password: string) => Promise<{ error?: string }>
  signUp: (email: string, password: string) => Promise<{ error?: string }>
  signOut: () => Promise<void>
  getAccessToken: () => Promise<string | null>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

function toUser(session: Session | null): AuthUser | null {
  if (!session?.user) return null
  return { id: session.user.id, email: session.user.email ?? '' }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [orgs, setOrgs] = useState<OrgMembership[]>([])
  const [loading, setLoading] = useState(true)

  // Keep the latest token in a ref so refreshOrgs / getAccessToken don't churn.
  const sessionRef = useRef<Session | null>(null)
  sessionRef.current = session

  const getAccessToken = useCallback(async (): Promise<string | null> => {
    // Prefer the live session (auto-refreshed by supabase-js).
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token ?? sessionRef.current?.access_token ?? null
  }, [])

  const refreshOrgs = useCallback(async () => {
    const token = await getAccessToken()
    if (!token) {
      setOrgs([])
      return
    }
    try {
      const me = await getMe(token)
      setOrgs(me.orgs)
    } catch {
      // Network / not-yet-provisioned — leave orgs empty rather than throwing.
      setOrgs([])
    }
  }, [getAccessToken])

  // Restore session on mount + subscribe to auth changes.
  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      sessionRef.current = data.session
      if (data.session) {
        refreshOrgs().finally(() => active && setLoading(false))
      } else {
        setLoading(false)
      }
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      sessionRef.current = next
      if (next) {
        void refreshOrgs()
      } else {
        setOrgs([])
      }
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [refreshOrgs])

  const signIn = useCallback(
    async (email: string, password: string): Promise<{ error?: string }> => {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      if (error) return { error: error.message }
      await refreshOrgs()
      return {}
    },
    [refreshOrgs],
  )

  const signUp = useCallback(
    async (email: string, password: string): Promise<{ error?: string }> => {
      const { data, error } = await supabase.auth.signUp({ email, password })
      if (error) return { error: error.message }
      // With email confirmation disabled (local Supabase), a session is returned
      // immediately. If not, surface a hint.
      if (!data.session) {
        return { error: 'Check your email to confirm your account, then sign in.' }
      }
      await refreshOrgs()
      return {}
    },
    [refreshOrgs],
  )

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setSession(null)
    sessionRef.current = null
    setOrgs([])
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user: toUser(session),
      session,
      loading,
      orgs,
      refreshOrgs,
      signIn,
      signUp,
      signOut,
      getAccessToken,
    }),
    [session, loading, orgs, refreshOrgs, signIn, signUp, signOut, getAccessToken],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an <AuthProvider>')
  return ctx
}
