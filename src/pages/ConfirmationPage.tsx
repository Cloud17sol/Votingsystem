import { useEffect } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { AppCreditFooter } from '../components/AppCreditFooter'
import { AppTopbar } from '../components/AppTopbar'
import { supabase } from '../lib/supabase'

function clearBallotSelectionsFromSessionStorage() {
  for (let i = sessionStorage.length - 1; i >= 0; i--) {
    const key = sessionStorage.key(i)
    if (key?.startsWith('ballotSelections:')) sessionStorage.removeItem(key)
  }
}

export function ConfirmationPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const submitted = Boolean((location.state as { submitted?: boolean } | null)?.submitted)

  useEffect(() => {
    if (submitted) clearBallotSelectionsFromSessionStorage()
  }, [submitted])

  if (!submitted) {
    return <Navigate to="/ballot" replace />
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex min-h-screen flex-col bg-page">
      <AppTopbar />
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-10">
        <div className="card-app w-full max-w-md space-y-5 p-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-mint-100 text-2xl" aria-hidden>
            ✓
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-bold tracking-tight text-zinc-900">Vote submitted</h1>
            <p className="text-sm leading-relaxed text-zinc-600">
              Your ballot has been recorded successfully. You cannot vote again.
            </p>
          </div>
          <button type="button" className="btn-primary w-full" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
        <AppCreditFooter className="mt-8 w-full max-w-md" />
      </div>
    </div>
  )
}
