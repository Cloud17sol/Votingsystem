import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AppCreditFooter } from '../components/AppCreditFooter'
import { AppTopbar } from '../components/AppTopbar'
import { MemberNotificationsPanel } from '../components/MemberNotificationsPanel'
import { supabase } from '../lib/supabase'

export function NotEligiblePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [signedIn, setSignedIn] = useState(false)

  const reason =
    (location.state as { reason?: string } | null)?.reason ??
    'You are not eligible to vote in this election.'

  useEffect(() => {
    let cancelled = false
    void supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setSignedIn(Boolean(data.session))
    })
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(Boolean(session))
    })
    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  async function handleLeave() {
    if (signedIn) {
      await supabase.auth.signOut()
    }
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex min-h-screen flex-col bg-page">
      <AppTopbar />
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-10">
        <MemberNotificationsPanel />
        <div className="card-app w-full max-w-md space-y-5 p-8">
          <div className="space-y-1">
            <h1 className="text-xl font-bold tracking-tight text-zinc-900">Access denied</h1>
            <p className="text-sm leading-relaxed text-zinc-600">{reason}</p>
          </div>
          <button type="button" className="btn-primary w-full" onClick={() => void handleLeave()}>
            {signedIn ? 'Sign out' : 'Back to login'}
          </button>
        </div>
        <AppCreditFooter className="mt-8 w-full max-w-md" />
      </div>
    </div>
  )
}
