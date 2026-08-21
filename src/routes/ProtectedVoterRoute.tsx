import { useEffect, useState } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { fetchMyVoterStatus } from '../lib/voterEligibility'

type GuardState =
  | 'loading'
  | 'allowed'
  | 'unauthenticated'
  | 'denied'
  | 'already_voted'

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

      const status = await fetchMyVoterStatus()
      if (cancelled) return

      if (!status) {
        setReason('Unable to verify eligibility right now.')
        setState('denied')
        return
      }

      if (status.eligible) {
        setState('allowed')
        return
      }

      if (status.alreadyVoted) {
        setState('already_voted')
        return
      }

      setReason(status.reason ?? 'You are not eligible to vote in this election.')
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

  if (state === 'already_voted') {
    return <Navigate to="/dashboard" replace />
  }

  if (state === 'denied') {
    return <Navigate to="/not-eligible" replace state={{ reason }} />
  }

  return <Outlet />
}
