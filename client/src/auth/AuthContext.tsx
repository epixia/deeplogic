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
  name: string
  avatarUrl: string
}

export interface AuthContextValue {
  user: AuthUser | null
  session: Session | null
  loading: boolean
  orgs: OrgMembership[]
  refreshOrgs: () => Promise<void>
  signIn: (email: string, password: string) => Promise<{ error?: string }>
  signUp: (email: string, password: string, name?: string) => Promise<{ error?: string }>
  resetPassword: (email: string) => Promise<{ error?: string }>
  updatePassword: (password: string) => Promise<{ error?: string }>
  updateProfile: (patch: { name?: string; avatarUrl?: string }) => Promise<{ error?: string }>
  signOut: () => Promise<void>
  getAccessToken: () => Promise<string | null>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

function toUser(session: Session | null): AuthUser | null {
  if (!session?.user) return null
  const m = (session.user.user_metadata ?? {}) as Record<string, unknown>
  return {
    id: session.user.id,
    email: session.user.email ?? '',
    name: typeof m.full_name === 'string' ? m.full_name : '',
    avatarUrl: typeof m.avatar_url === 'string' ? m.avatar_url : '',
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [orgs, setOrgs] = useState<OrgMembership[]>([])
  const [loading, setLoading] = useState(true)

  const sessionRef = useRef<Session | null>(null)
  sessionRef.current = session

  const getAccessToken = useCallback(async (): Promise<string | null> => {
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
      setOrgs([])
    }
  }, [getAccessToken])

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
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) return { error: error.message }
      await refreshOrgs()
      return {}
    },
    [refreshOrgs],
  )

  const signUp = useCallback(
    async (email: string, password: string, name?: string): Promise<{ error?: string }> => {
      const { data, error } = await supabase.auth.signUp({
        email, password,
        options: name ? { data: { full_name: name } } : undefined,
      })
      if (error) return { error: error.message }
      if (!data.session) {
        return { error: 'Check your email to confirm your account, then sign in.' }
      }
      await refreshOrgs()
      return {}
    },
    [refreshOrgs],
  )

  const resetPassword = useCallback(
    async (email: string): Promise<{ error?: string }> => {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      return error ? { error: error.message } : {}
    },
    [],
  )

  const updatePassword = useCallback(
    async (password: string): Promise<{ error?: string }> => {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) return { error: error.message }
      await refreshOrgs()
      return {}
    },
    [refreshOrgs],
  )

  const updateProfile = useCallback(
    async (patch: { name?: string; avatarUrl?: string }): Promise<{ error?: string }> => {
      const data: Record<string, unknown> = {}
      if (patch.name !== undefined) data.full_name = patch.name
      if (patch.avatarUrl !== undefined) data.avatar_url = patch.avatarUrl
      const { error } = await supabase.auth.updateUser({ data })
      // Session refreshes via onAuthStateChange (USER_UPDATED).
      return error ? { error: error.message } : {}
    },
    [],
  )

  const signOut = useCallback(async () => {
    // Try to revoke server-side, but NEVER let a slow/hung network call block
    // sign-out — cap it so we always proceed to clear + redirect.
    try {
      await Promise.race([
        supabase.auth.signOut({ scope: 'global' }),
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ])
    } catch { /* ignore */ }
    // Guarantee the persisted session is gone (storageKey: 'dl-auth'). This is
    // the belt-and-suspenders that makes sign-out actually stick on reload.
    try {
      localStorage.removeItem('dl-auth')
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith('dl-auth') || (k.startsWith('sb-') && k.includes('auth'))) localStorage.removeItem(k)
      }
    } catch { /* ignore */ }
    setSession(null)
    sessionRef.current = null
    setOrgs([])
    // HARD redirect (not SPA nav): tears down all in-flight requests and the
    // 401 refresh-retry that could otherwise resurrect the session, and reloads
    // the app with no token in memory. Guarantees a real sign-out.
    window.location.assign('/login')
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
      resetPassword,
      updatePassword,
      updateProfile,
      signOut,
      getAccessToken,
    }),
    [
      session,
      loading,
      orgs,
      refreshOrgs,
      signIn,
      signUp,
      resetPassword,
      updatePassword,
      updateProfile,
      signOut,
      getAccessToken,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an <AuthProvider>')
  return ctx
}
