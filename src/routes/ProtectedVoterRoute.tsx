import { useEffect, useState } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { checkVoterEligibility } from '../lib/voterEligibility'

type GuardState = 'loading' | 'allowed' | 'unauthenticated' | 'denied'

export function ProtectedVoterRoute() {
  const [state, setState] = useState<GuardState>('loading')
  const [reason, setReason] = useState<string>('')

  useEffect(() => {
    let cancelled = false

    async function runGuard() {
      const { data } = await supabase.auth.getSession()
      const session = data.session

      if (!session) {
        if (!cancelled) setState('unauthenticated')
        return
      }

      const result = await checkVoterEligibility(session.user)
      if (cancelled) return

      if (result.eligible) {
        setState('allowed')
        return
      }

      setReason(result.reason)
      setState('denied')
    }

    void runGuard()
    return () => {
      cancelled = true
    }
  }, [])

  if (state === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-page px-4">
        <p className="text-sm text-zinc-600">Checking voter access...</p>
      </div>
    )
  }

  if (state === 'unauthenticated') {
    return <Navigate to="/login" replace />
  }

  if (state === 'denied') {
    return <Navigate to="/not-eligible" replace state={{ reason }} />
  }

  return <Outlet />
}
