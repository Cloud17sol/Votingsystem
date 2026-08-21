import { useEffect } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { AppCreditFooter } from '../components/AppCreditFooter'
import { AppTopbar } from '../components/AppTopbar'
import { GridBackground } from '../components/GridBackground'
import { VoterNav } from '../components/VoterNav'
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
    return <Navigate to="/dashboard" replace />
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="relative flex min-h-screen flex-col bg-page">
      <GridBackground />
      <div className="relative z-10 flex min-h-screen flex-col">
        <AppTopbar />
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-10">
          <VoterNav canVote={false} />
          <div className="card-app w-full space-y-5 p-8 text-center">
            <div
              className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-mint-100 text-2xl"
              aria-hidden
            >
              ✓
            </div>
            <div className="space-y-2">
              <h1 className="text-xl font-bold tracking-tight text-zinc-900">Vote submitted</h1>
              <p className="text-sm leading-relaxed text-zinc-600">
                Your ballot has been recorded successfully. You cannot vote again.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Link to="/dashboard" className="btn-primary w-full no-underline">
                Back to home
              </Link>
              <button type="button" className="btn-secondary w-full" onClick={handleSignOut}>
                Sign out
              </button>
            </div>
          </div>
          <AppCreditFooter className="mt-4 w-full" />
        </div>
      </div>
    </div>
  )
}
