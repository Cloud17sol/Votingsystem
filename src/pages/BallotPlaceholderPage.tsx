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
  status: 'draft' | 'open' | 'closed'
  starts_at: string | null
  ends_at: string
  logo_url?: string | null
}

type PositionRow = {
  id: string
  election_id: string
  name: string
  sort_order: number
}

type CandidateRow = {
  id: string
  position_id: string
  full_name: string
}

type Selections = Record<string, string>

type BallotLocationState = {
  selections?: Selections
  electionId?: string
} | null

function ballotStorageKey(electionId: string) {
  return `ballotSelections:${electionId}`
}

function filterSelectionsForBallot(
  raw: Selections | undefined,
  positions: PositionRow[],
  candidates: CandidateRow[],
): Selections {
  if (!raw) return {}
  const positionIds = new Set(positions.map((p) => p.id))
  const out: Selections = {}
  for (const [positionId, candidateId] of Object.entries(raw)) {
    if (!positionIds.has(positionId)) continue
    const ok = candidates.some(
      (c) => c.id === candidateId && c.position_id === positionId,
    )
    if (ok) out[positionId] = candidateId
  }
  return out
}

function readStoredSelections(electionId: string): Selections | null {
  try {
    const raw = sessionStorage.getItem(ballotStorageKey(electionId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null) return null
    return parsed as Selections
  } catch {
    return null
  }
}

function writeStoredSelections(electionId: string, selections: Selections) {
  sessionStorage.setItem(ballotStorageKey(electionId), JSON.stringify(selections))
}

function clearStoredSelections(electionId: string) {
  sessionStorage.removeItem(ballotStorageKey(electionId))
}

function isElectionActive(election: ElectionRow, now: Date): boolean {
  if (election.status !== 'open') return false
  const nowMs = now.getTime()
  const startsMs = election.starts_at ? new Date(election.starts_at).getTime() : null
  const endsMs = new Date(election.ends_at).getTime()
  return (startsMs === null || nowMs >= startsMs) && nowMs < endsMs
}

export function BallotPlaceholderPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [election, setElection] = useState<ElectionRow | null>(null)
  const [positions, setPositions] = useState<PositionRow[]>([])
  const [candidates, setCandidates] = useState<CandidateRow[]>([])
  const [selections, setSelections] = useState<Selections>({})
  const [voterName, setVoterName] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const navStateSnapshot = location.state as BallotLocationState

    async function loadBallot() {
      setLoading(true)
      setError('')

      const displayName = await fetchMyMemberFullName()
      if (!cancelled) setVoterName(displayName)

      const { data: openElections, error: electionError } = await supabase
        .from('elections')
        .select('id,title,status,starts_at,ends_at,created_at,logo_url')
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(10)

      if (electionError) {
        if (!cancelled) {
          setError('Unable to load election.')
          setLoading(false)
        }
        return
      }

      const now = new Date()
      const activeElection = (openElections as ElectionRow[] | null)?.find((item) =>
        isElectionActive(item, now),
      )

      if (!activeElection) {
        if (!cancelled) {
          setError('No active election found.')
          setLoading(false)
        }
        return
      }

      const { data: positionRows, error: positionsError } = await supabase
        .from('positions')
        .select('id,election_id,name,sort_order')
        .eq('election_id', activeElection.id)
        .order('sort_order', { ascending: true })

      if (positionsError) {
        if (!cancelled) {
          setError('Unable to load positions.')
          setLoading(false)
        }
        return
      }

      const positionIds = (positionRows as PositionRow[] | null)?.map((item) => item.id) ?? []

      let candidateRows: CandidateRow[] = []
      if (positionIds.length > 0) {
        const { data, error: candidatesError } = await supabase
          .from('candidates')
          .select('id,position_id,full_name')
          .in('position_id', positionIds)
          .order('full_name', { ascending: true })

        if (candidatesError) {
          if (!cancelled) {
            setError('Unable to load candidates.')
            setLoading(false)
          }
          return
        }

        candidateRows = (data as CandidateRow[] | null) ?? []
      }

      if (!cancelled) {
        const loadedPositions = (positionRows as PositionRow[] | null) ?? []
        const shouldRestoreFromNav =
          navStateSnapshot?.electionId === activeElection.id &&
          navStateSnapshot?.selections &&
          Object.keys(navStateSnapshot.selections).length > 0
        const fromNav = shouldRestoreFromNav
          ? filterSelectionsForBallot(
              navStateSnapshot.selections,
              loadedPositions,
              candidateRows,
            )
          : null
        const fromStorage = filterSelectionsForBallot(
          readStoredSelections(activeElection.id) ?? undefined,
          loadedPositions,
          candidateRows,
        )
        const restored =
          fromNav && Object.keys(fromNav).length > 0
            ? fromNav
            : Object.keys(fromStorage).length > 0
              ? fromStorage
              : {}

        setElection(activeElection)
        setPositions(loadedPositions)
        setCandidates(candidateRows)
        setSelections(restored)
        if (Object.keys(restored).length > 0) {
          writeStoredSelections(activeElection.id, restored)
        }
        setLoading(false)
      }
    }

    void loadBallot()
    return () => {
      cancelled = true
    }
    // Intentionally run once on mount so returning from /review with state restores selections
    // without re-running after navigate(..., { replace: true }) clears location.state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const candidatesByPosition = useMemo(() => {
    const grouped: Record<string, CandidateRow[]> = {}
    for (const candidate of candidates) {
      if (!grouped[candidate.position_id]) {
        grouped[candidate.position_id] = []
      }
      grouped[candidate.position_id].push(candidate)
    }
    return grouped
  }, [candidates])

  const totalPositions = positions.length
  const selectedCount = Object.keys(selections).length
  const canReview = totalPositions > 0 && selectedCount === totalPositions

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/login', { replace: true })
  }

  function handleSelect(positionId: string, candidateId: string) {
    if (!election) return
    setSelections((prev) => {
      const next = { ...prev, [positionId]: candidateId }
      writeStoredSelections(election.id, next)
      return next
    })
  }

  function handleResetBallot() {
    if (!election || Object.keys(selections).length === 0) return
    const ok = window.confirm('Clear all selections on your ballot?')
    if (!ok) return
    clearStoredSelections(election.id)
    setSelections({})
  }

  function handleReview() {
    if (!election) return
    navigate('/review', {
      state: {
        election,
        positions,
        candidates,
        selections,
      },
    })
  }

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col bg-page">
        <AppTopbar />
        <div className="flex flex-1 items-center justify-center px-4">
          <p className="text-sm font-medium text-zinc-500">Loading ballot...</p>
        </div>
      </div>
    )
  }

  if (error || !election) {
    return (
      <div className="flex min-h-screen flex-col bg-page">
        <AppTopbar />
        <div className="flex flex-1 items-center justify-center px-4 py-10">
          <div className="card-app w-full max-w-md space-y-4 p-8">
            {voterName ? (
              <p className="text-sm text-zinc-600">
                Welcome, <span className="font-semibold text-zinc-900">{voterName}</span>
              </p>
            ) : null}
            <h1 className="text-lg font-bold text-zinc-900">Ballot unavailable</h1>
            <p className="text-sm text-zinc-600">{error || 'Unable to load ballot.'}</p>
            <button type="button" className="btn-primary" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        </div>
      </div>
    )
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
              Your ballot
            </p>
            <h1 className="relative mt-2 text-2xl font-bold leading-tight tracking-tight text-white sm:text-[1.65rem]">
              {election.title}
            </h1>
          </div>
          <div className="relative z-[1] -mt-6 rounded-t-3xl border border-zinc-100/80 bg-white px-5 py-5 shadow-[0_-4px_24px_rgba(15,23,42,0.06)] sm:px-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
              {election.logo_url ? (
                <div className="flex shrink-0 justify-center sm:justify-start">
                  <div className="rounded-2xl bg-zinc-50/90 p-3 ring-1 ring-zinc-100">
                    <img
                      src={election.logo_url}
                      alt=""
                      className="h-14 max-h-[4.5rem] w-auto max-w-[10rem] object-contain object-left sm:h-[4.5rem] sm:max-w-[12rem]"
                    />
                  </div>
                </div>
              ) : null}
              <div className="min-w-0 flex-1 space-y-3">
                {voterName ? (
                  <p className="text-sm text-zinc-600">
                    Welcome,{' '}
                    <span className="font-semibold text-zinc-900">{voterName}</span>
                  </p>
                ) : null}
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
                  <span className="inline-flex w-fit items-center rounded-full bg-mint-100 px-3 py-1 text-xs font-semibold text-mint-800 ring-1 ring-mint-700/10">
                    {selectedCount}/{totalPositions} selected
                  </span>
                  <p className="text-sm leading-snug text-zinc-600">
                    Select one candidate per position.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {positions.map((position) => {
          const positionCandidates = candidatesByPosition[position.id] ?? []
          return (
            <section key={position.id} className="card-app overflow-hidden">
              <div className="bg-gradient-to-br from-forest-950 via-forest-900 to-[#1d5c47] px-5 py-3.5 shadow-[inset_0_-1px_0_rgba(255,255,255,0.1)]">
                <h2 className="text-base font-bold tracking-tight text-white">{position.name}</h2>
              </div>
              <div className="space-y-4 p-5">
              {positionCandidates.length === 0 ? (
                <p className="text-sm text-zinc-500">No candidates for this position.</p>
              ) : (
                <div className="space-y-2">
                  {positionCandidates.map((candidate) => (
                    <label
                      key={candidate.id}
                      className="flex cursor-pointer items-center gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3 transition-colors hover:bg-zinc-50 has-[:checked]:border-mint-700/45 has-[:checked]:bg-mint-50/70"
                    >
                      <input
                        type="radio"
                        name={`position-${position.id}`}
                        value={candidate.id}
                        checked={selections[position.id] === candidate.id}
                        onChange={() => handleSelect(position.id, candidate.id)}
                        className="h-4 w-4 border-zinc-300 text-forest-900 focus:ring-forest-900/30"
                      />
                      <span className="text-sm font-medium text-zinc-800">{candidate.full_name}</span>
                    </label>
                  ))}
                </div>
              )}
              </div>
            </section>
          )
        })}

        <div className="card-app flex flex-col gap-3 p-5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:gap-2">
            <button
              type="button"
              className="rounded-full border border-amber-200/90 bg-amber-50/80 px-4 py-2 text-sm font-medium text-amber-950 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-40"
              onClick={handleResetBallot}
              disabled={Object.keys(selections).length === 0}
            >
              Reset ballot
            </button>
          </div>
          <button
            type="button"
            className="btn-primary sm:ml-auto"
            onClick={handleReview}
            disabled={!canReview}
          >
            Review Ballot
          </button>
        </div>
        {!canReview ? (
          <p className="px-1 text-center text-sm text-zinc-500">
            Complete all positions to review your ballot.
          </p>
        ) : null}
        <AppCreditFooter className="mt-5 px-1 pb-4" />
      </div>
    </div>
  )
}
