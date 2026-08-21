import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AppCreditFooter } from '../components/AppCreditFooter'
import { AppTopbar } from '../components/AppTopbar'
import { MemberNotificationsPanel } from '../components/MemberNotificationsPanel'
import { VoterNav } from '../components/VoterNav'
import { supabase } from '../lib/supabase'
import { fetchMyMemberFullName } from '../lib/voterEligibility'

type ElectionRow = {
  id: string
  title: string
  logo_url?: string | null
}

type PositionRow = {
  id: string
  name: string
  sort_order: number
}

type CandidateRow = {
  id: string
  position_id: string
  full_name: string
}

type ReviewState = {
  election: ElectionRow
  positions: PositionRow[]
  candidates: CandidateRow[]
  selections: Record<string, string>
}

export function ReviewBallotPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as ReviewState | null
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [voterName, setVoterName] = useState<string | null>(null)

  useEffect(() => {
    void fetchMyMemberFullName().then(setVoterName)
  }, [])

  const candidateById = useMemo(() => {
    const map: Record<string, CandidateRow> = {}
    for (const candidate of state?.candidates ?? []) {
      map[candidate.id] = candidate
    }
    return map
  }, [state?.candidates])

  if (!state) {
    return (
      <div className="flex min-h-screen flex-col bg-page">
        <AppTopbar />
        <div className="flex flex-1 items-center justify-center px-4 py-10">
          <div className="card-app w-full max-w-md space-y-4 p-8">
            <h1 className="text-lg font-bold text-zinc-900">No ballot to review</h1>
            <p className="text-sm text-zinc-600">Please go back and complete your ballot.</p>
            <button
              type="button"
              className="btn-primary"
              onClick={() => navigate('/ballot', { replace: true })}
            >
              Back to ballot
            </button>
          </div>
        </div>
      </div>
    )
  }

  const reviewState = state

  async function handleSubmitVote() {
    setSubmitError('')
    setSubmitting(true)

    const { error } = await supabase.rpc('submit_vote', {
      p_election_id: reviewState.election.id,
      p_selections: reviewState.selections,
    })

    setSubmitting(false)

    if (error) {
      setSubmitError(error.message || 'Unable to submit vote.')
      return
    }

    navigate('/confirmation', { replace: true, state: { submitted: true } })
  }

  return (
    <div className="flex min-h-screen flex-col bg-page">
      <AppTopbar />
      <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-6">
        <VoterNav active="ballot" canVote />
        <MemberNotificationsPanel />
        <div className="card-app overflow-hidden shadow-[0_8px_40px_rgba(20,51,42,0.12)]">
          <div className="relative bg-gradient-to-br from-forest-950 via-forest-900 to-[#1d5c47] px-5 pb-10 pt-6 sm:px-6 sm:pb-11">
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.12]"
              style={{
                backgroundImage:
                  'radial-gradient(circle at 85% 0%, #fff 0%, transparent 45%), radial-gradient(circle at 10% 90%, #fff 0%, transparent 40%)',
              }}
              aria-hidden
            />
            <p className="relative text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-white/75">
              Review before you submit
            </p>
            <h1 className="relative mt-2 text-2xl font-bold leading-tight tracking-tight text-white sm:text-[1.65rem]">
              Review ballot
            </h1>
            <p className="relative mt-2 text-sm font-medium text-white/85">{reviewState.election.title}</p>
          </div>
          <div className="relative z-[1] -mt-6 rounded-t-3xl border border-zinc-100/80 bg-white px-5 py-5 shadow-[0_-4px_24px_rgba(15,23,42,0.06)] sm:px-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
              {reviewState.election.logo_url ? (
                <div className="flex shrink-0 justify-center sm:justify-start">
                  <div className="rounded-2xl bg-zinc-50/90 p-3 ring-1 ring-zinc-100">
                    <img
                      src={reviewState.election.logo_url}
                      alt=""
                      className="h-14 max-h-[4.5rem] w-auto max-w-[10rem] object-contain object-left sm:h-[4.5rem] sm:max-w-[12rem]"
                    />
                  </div>
                </div>
              ) : null}
              <div className="min-w-0 flex-1 space-y-2">
                {voterName ? (
                  <p className="text-sm text-zinc-600">
                    Welcome, <span className="font-semibold text-zinc-900">{voterName}</span>
                  </p>
                ) : null}
                <p className="text-sm text-zinc-600">
                  Confirm your choices below, then submit your vote.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="card-app space-y-3 p-5">
          {reviewState.positions.map((position) => {
            const candidateId = reviewState.selections[position.id]
            const selectedCandidate = candidateId ? candidateById[candidateId] : null

            return (
              <div
                key={position.id}
                className="flex items-start justify-between gap-3 rounded-2xl border border-zinc-200 bg-zinc-50/50 px-4 py-3"
              >
                <p className="text-sm font-semibold text-zinc-900">{position.name}</p>
                <p className="text-right text-sm font-medium text-zinc-700">
                  {selectedCandidate?.full_name ?? 'No selection'}
                </p>
              </div>
            )
          })}
        </div>

        <div className="card-app space-y-4 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <button
              type="button"
              className="btn-secondary"
              onClick={() =>
                navigate('/ballot', {
                  state: {
                    selections: reviewState.selections,
                    electionId: reviewState.election.id,
                  },
                })
              }
              disabled={submitting}
            >
              Back to ballot
            </button>
            <button
              type="button"
              className="btn-primary sm:flex-1"
              onClick={handleSubmitVote}
              disabled={submitting}
            >
              {submitting ? 'Submitting...' : 'Confirm and Submit Vote'}
            </button>
          </div>
          {submitError ? <p className="text-sm font-medium text-red-700">{submitError}</p> : null}
        </div>
        <AppCreditFooter className="mt-4 pb-4" />
      </div>
    </div>
  )
}
