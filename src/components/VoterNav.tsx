import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export type VoterNavActive = 'home' | 'ballot' | 'guidelines'

type VoterNavProps = {
  active?: VoterNavActive
  /** When false, Ballot is shown but not clickable (e.g. already voted). */
  canVote?: boolean
}

function tabClass(isActive: boolean, disabled?: boolean) {
  if (disabled) {
    return 'nav-tab border border-zinc-200 bg-zinc-100 text-zinc-400 cursor-not-allowed no-underline'
  }
  return `nav-tab no-underline ${isActive ? 'nav-tab-active' : 'nav-tab-inactive'}`
}

export function VoterNav({ active, canVote = true }: VoterNavProps) {
  const navigate = useNavigate()

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/login', { replace: true })
  }

  return (
    <nav
      className="flex flex-wrap items-center gap-2 border-b border-zinc-200/80 pb-4"
      aria-label="Voter"
    >
      <Link to="/dashboard" className={tabClass(active === 'home')}>
        Home
      </Link>
      {canVote ? (
        <Link to="/ballot" className={tabClass(active === 'ballot')}>
          Ballot
        </Link>
      ) : (
        <span className={tabClass(false, true)} aria-disabled="true" title="You have already voted">
          Ballot
        </span>
      )}
      <Link to="/dashboard#guidelines" className={tabClass(active === 'guidelines')}>
        Guidelines
      </Link>
      <button type="button" className="btn-secondary ml-auto" onClick={() => void handleSignOut()}>
        Sign out
      </button>
    </nav>
  )
}
