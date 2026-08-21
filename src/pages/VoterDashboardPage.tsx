import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { AppCreditFooter } from '../components/AppCreditFooter'
import { AppTopbar } from '../components/AppTopbar'
import { GridBackground } from '../components/GridBackground'
import { MemberNotificationsPanel } from '../components/MemberNotificationsPanel'
import { VoterNav } from '../components/VoterNav'
import { supabase } from '../lib/supabase'
import {
  fetchMyMemberFullName,
  fetchMyVoterStatus,
  type MyVoterStatus,
} from '../lib/voterEligibility'

type ElectionSummary = {
  id: string
  title: string
  status: string
  starts_at: string | null
  ends_at: string
  logo_url: string | null
}

type TurnoutStats = {
  registeredEligible: number
  votesCast: number
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  } catch {
    return '—'
  }
}

function firstName(fullName: string | null): string {
  if (!fullName?.trim()) return 'there'
  return fullName.trim().split(/\s+/)[0] ?? 'there'
}

export function VoterDashboardPage() {
  const [bootstrapping, setBootstrapping] = useState(true)
  const [redirectTo, setRedirectTo] = useState<string | null>(null)
  const [voterName, setVoterName] = useState<string | null>(null)
  const [status, setStatus] = useState<MyVoterStatus | null>(null)
  const [election, setElection] = useState<ElectionSummary | null>(null)
  const [turnout, setTurnout] = useState<TurnoutStats | null>(null)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function load() {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session) {
        if (!cancelled) setRedirectTo('/login')
        return
      }

      const email = session.user.email?.trim().toLowerCase()
      if (!email) {
        if (!cancelled) setRedirectTo('/login')
        return
      }

      const { data: member } = await supabase
        .from('members')
        .select('is_admin,full_name')
        .ilike('email', email)
        .maybeSingle()

      if (!member) {
        await supabase.auth.signOut()
        if (!cancelled) setRedirectTo('/login')
        return
      }

      if (member.is_admin) {
        if (!cancelled) setRedirectTo('/admin')
        return
      }

      const displayName =
        (member.full_name as string | null)?.trim() || (await fetchMyMemberFullName())
      const voterStatus = await fetchMyVoterStatus()

      if (!voterStatus) {
        if (!cancelled) {
          setLoadError('Unable to load your voting status right now.')
          setBootstrapping(false)
        }
        return
      }

      // Not a voting-capable member path (not on list / not allowed) → keep existing UX
      if (
        !voterStatus.eligible &&
        !voterStatus.alreadyVoted &&
        voterStatus.reason !== 'There is no active election right now.'
      ) {
        if (!cancelled) {
          setStatus(voterStatus)
          setRedirectTo('/not-eligible')
        }
        return
      }

      let electionRow: ElectionSummary | null = null
      let turnoutRow: TurnoutStats | null = null
      if (voterStatus.electionId) {
        const { data } = await supabase
          .from('elections')
          .select('id,title,status,starts_at,ends_at,logo_url')
          .eq('id', voterStatus.electionId)
          .maybeSingle()
        electionRow = (data as ElectionSummary | null) ?? null

        const { data: statsData } = await supabase.rpc('get_election_turnout_stats', {
          p_election_id: voterStatus.electionId,
        })
        const stats = (statsData as { registered_eligible: number; votes_cast: number }[] | null)?.[0]
        if (stats) {
          turnoutRow = {
            registeredEligible: Number(stats.registered_eligible) || 0,
            votesCast: Number(stats.votes_cast) || 0,
          }
        }
      }

      if (!cancelled) {
        setVoterName(displayName)
        setStatus(voterStatus)
        setElection(electionRow)
        setTurnout(turnoutRow)
        setBootstrapping(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (bootstrapping) return
    if (window.location.hash !== '#guidelines') return
    const el = document.getElementById('guidelines')
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [bootstrapping])

  if (redirectTo) {
    return (
      <Navigate
        to={redirectTo}
        replace
        state={
          redirectTo === '/not-eligible' && status?.reason
            ? { reason: status.reason }
            : undefined
        }
      />
    )
  }

  if (bootstrapping) {
    return (
      <div className="relative flex min-h-screen flex-col bg-page">
        <GridBackground />
        <div className="relative z-10 flex min-h-screen flex-col">
          <AppTopbar />
          <div className="flex flex-1 items-center justify-center px-4">
            <p className="text-sm font-medium text-zinc-500">Loading your dashboard…</p>
          </div>
        </div>
      </div>
    )
  }

  const canVote = Boolean(status?.eligible)
  const alreadyVoted = Boolean(status?.alreadyVoted)
  const noElection =
    !canVote && !alreadyVoted && status?.reason === 'There is no active election right now.'

  return (
    <div className="relative flex min-h-screen flex-col bg-page">
      <GridBackground />
      <div className="relative z-10 flex min-h-screen flex-col">
        <AppTopbar />
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-4 py-6">
          <VoterNav active="home" canVote={canVote} />

          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
              Hello, {firstName(voterName)}
            </h1>
            <p className="text-sm text-zinc-600">
              Welcome to the Alumni Voting System. Use the links above to vote or read guidelines.
            </p>
          </div>

          {loadError ? (
            <div className="card-app space-y-3 p-6">
              <p className="text-sm text-red-700">{loadError}</p>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => window.location.reload()}
              >
                Try again
              </button>
            </div>
          ) : null}

          <section className="card-app overflow-hidden shadow-[0_8px_40px_rgba(20,51,42,0.1)]">
            <div className="bg-gradient-to-br from-forest-950 via-forest-900 to-[#1d5c47] px-5 py-5 sm:px-6">
              <p className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-white/75">
                {alreadyVoted ? 'Completed' : canVote ? 'Ongoing election' : 'Election'}
              </p>
              <h2 className="mt-2 text-xl font-bold leading-tight tracking-tight text-white sm:text-2xl">
                {election?.title ?? (noElection ? 'No active election' : 'Election')}
              </h2>
            </div>
            <div className="space-y-4 px-5 py-5 sm:px-6">
              {election?.logo_url ? (
                <div className="rounded-2xl bg-zinc-50/90 p-3 ring-1 ring-zinc-100 w-fit">
                  <img
                    src={election.logo_url}
                    alt=""
                    className="h-14 max-h-[4.5rem] w-auto max-w-[10rem] object-contain"
                  />
                </div>
              ) : null}

              {election ? (
                <dl className="grid gap-2 text-sm text-zinc-600 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      Starts
                    </dt>
                    <dd className="mt-0.5 font-medium text-zinc-800">
                      {formatWhen(election.starts_at)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      Ends
                    </dt>
                    <dd className="mt-0.5 font-medium text-zinc-800">
                      {formatWhen(election.ends_at)}
                    </dd>
                  </div>
                </dl>
              ) : null}

              {turnout ? (
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50/80 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      Registered voters
                    </p>
                    <p className="mt-1 text-2xl font-bold tracking-tight text-zinc-900">
                      {turnout.registeredEligible}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50/80 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      Votes cast
                    </p>
                    <p className="mt-1 text-2xl font-bold tracking-tight text-zinc-900">
                      {turnout.votesCast}
                    </p>
                  </div>
                </div>
              ) : null}

              {alreadyVoted ? (
                <div className="space-y-3 rounded-2xl border border-mint-700/20 bg-mint-50/80 px-4 py-3">
                  <p className="text-sm font-medium text-mint-900">
                    You’ve already voted in this election. Thank you.
                  </p>
                  <p className="text-xs text-mint-800">
                    Your ballot is recorded. You cannot vote again.
                  </p>
                </div>
              ) : null}

              {noElection ? (
                <p className="text-sm text-zinc-600">
                  There is no open election right now. Check back later, or read the guidelines
                  below.
                </p>
              ) : null}

              {!alreadyVoted && !canVote && !noElection && status?.reason ? (
                <p className="text-sm text-zinc-600">{status.reason}</p>
              ) : null}

              {canVote ? (
                <Link to="/ballot" className="btn-primary inline-flex w-full no-underline sm:w-auto">
                  Vote now
                </Link>
              ) : null}
            </div>
          </section>

          <section id="guidelines" className="scroll-mt-6 space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-wide text-zinc-500">Guidelines</h2>
            <div className="card-app space-y-3 p-5 text-sm leading-relaxed text-zinc-600">
              <p>Select one candidate for each position on the ballot.</p>
              <p>Review your choices carefully before submitting. Votes cannot be changed.</p>
              <p>Use a private device when possible. Sign out when you are finished.</p>
            </div>
            <MemberNotificationsPanel />
          </section>

          <AppCreditFooter className="mt-auto pt-4" />
        </div>
      </div>
    </div>
  )
}
