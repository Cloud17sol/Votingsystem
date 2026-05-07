import { useEffect, useState } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type GuardState = 'loading' | 'allowed' | 'unauthenticated' | 'forbidden'

export function ProtectedAdminRoute() {
  const [state, setState] = useState<GuardState>('loading')

  useEffect(() => {
    let cancelled = false

    async function runGuard() {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session) {
        if (!cancelled) setState('unauthenticated')
        return
      }

      const userEmail = session.user.email?.trim().toLowerCase() ?? ''
      const { data: member } = await supabase
        .from('members')
        .select('is_admin')
        .ilike('email', userEmail)
        .maybeSingle()

      if (!cancelled) {
        setState(member?.is_admin ? 'allowed' : 'forbidden')
      }
    }

    void runGuard()
    return () => {
      cancelled = true
    }
  }, [])

  if (state === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-page px-4">
        <p className="text-sm text-zinc-600">Checking admin access...</p>
      </div>
    )
  }

  if (state === 'unauthenticated') return <Navigate to="/login" replace />
  if (state === 'forbidden') return <Navigate to="/not-eligible" replace state={{ reason: 'Admin access required.' }} />

  return <Outlet />
}
