import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AppCreditFooter } from '../components/AppCreditFooter'
import { AppTopbar } from '../components/AppTopbar'
import { GridBackground } from '../components/GridBackground'
import { supabase } from '../lib/supabase'

type NominationPosition = {
  id: string
  name: string
  sort_order: number
}

type PendingNomination = {
  key: string
  nomination_position_id: string
  position_name: string
  nominee_full_name: string
}

function newPendingKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function NominationsPage() {
  const [positions, setPositions] = useState<NominationPosition[]>([])
  const [submissionsOpen, setSubmissionsOpen] = useState(true)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [positionId, setPositionId] = useState('')
  const [nomineeName, setNomineeName] = useState('')
  const [pendingNominations, setPendingNominations] = useState<PendingNomination[]>([])
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')
      const [posRes, cfgRes] = await Promise.all([
        supabase
          .from('nomination_positions')
          .select('id,name,sort_order')
          .order('sort_order', { ascending: true })
          .order('name', { ascending: true }),
        supabase.from('nomination_config').select('submissions_open').eq('id', 1).maybeSingle(),
      ])

      if (cancelled) return
      setLoading(false)
      if (!cfgRes.error && cfgRes.data && typeof cfgRes.data.submissions_open === 'boolean') {
        setSubmissionsOpen(cfgRes.data.submissions_open)
      } else {
        setSubmissionsOpen(true)
      }
      if (posRes.error) {
        setError('Could not load nomination positions. Try again later.')
        setPositions([])
        return
      }
      const rows = (posRes.data ?? []) as NominationPosition[]
      setPositions(rows)
      setPositionId((current) => {
        if (current && rows.some((r) => r.id === current)) return current
        return rows[0]?.id ?? ''
      })
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  function positionNameForId(id: string): string {
    return positions.find((p) => p.id === id)?.name ?? '—'
  }

  function handleAddToList(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSuccess(false)
    const name = nomineeName.trim()
    if (!positionId) {
      setError('Choose a position.')
      return
    }
    if (!name) {
      setError('Enter the nominee’s full name.')
      return
    }
    if (!submissionsOpen) {
      setError('Nominations are closed. Submissions are no longer accepted.')
      return
    }

    const dup = pendingNominations.some(
      (p) =>
        p.nomination_position_id === positionId &&
        p.nominee_full_name.trim().toLowerCase() === name.toLowerCase(),
    )
    if (dup) {
      setError('That person is already on your list for this position.')
      return
    }

    const position_name = positionNameForId(positionId)
    setPendingNominations((prev) => [
      ...prev,
      {
        key: newPendingKey(),
        nomination_position_id: positionId,
        position_name,
        nominee_full_name: name,
      },
    ])
    setNomineeName('')
  }

  function handleRemovePending(key: string) {
    setPendingNominations((prev) => prev.filter((p) => p.key !== key))
  }

  async function handleSubmitAll() {
    setError('')
    setSuccess(false)
    if (pendingNominations.length === 0) return
    if (!submissionsOpen) {
      setError('Nominations are closed. Submissions are no longer accepted.')
      return
    }

    setSubmitting(true)
    const rows = pendingNominations.map((p) => ({
      nomination_position_id: p.nomination_position_id,
      nominee_full_name: p.nominee_full_name,
    }))
    const { error: insertError } = await supabase.from('nominations').insert(rows)
    setSubmitting(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    setPendingNominations([])
    setNomineeName('')
    setSuccess(true)
  }

  return (
    <div className="relative flex min-h-screen flex-col bg-page">
      <GridBackground />
      <div className="relative z-10 flex min-h-screen flex-col">
        <AppTopbar />
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-8">
          <div className="mb-6 flex flex-wrap gap-2 border-b border-zinc-200 pb-4">
            <Link to="/login" className="nav-tab nav-tab-inactive no-underline">
              Sign in
            </Link>
            <Link to="/register" className="nav-tab nav-tab-inactive no-underline">
              Register
            </Link>
            <span className="nav-tab nav-tab-active">Nominations</span>
          </div>

        <div className="card-app space-y-5 p-8">
          <div className="space-y-1">
            <h1 className="text-xl font-bold tracking-tight text-zinc-900">Submit nominations</h1>
            <p className="text-sm text-zinc-500">
              Add each nomination below. Nothing is sent until you review your list and choose{' '}
              <span className="font-medium text-zinc-600">Submit all nominations</span>. No sign-in
              required.
            </p>
          </div>

          {loading ? (
            <p className="text-sm text-zinc-500">Loading positions…</p>
          ) : positions.length === 0 ? (
            <p className="text-sm text-zinc-600">
              Nomination categories are not open yet. Please check back later.
            </p>
          ) : !submissionsOpen ? (
            <p className="text-sm text-zinc-600">
              The nomination period is closed. New submissions are not being accepted. Thank you to
              everyone who nominated candidates.
            </p>
          ) : (
            <div className="space-y-6">
              <form className="space-y-4" onSubmit={handleAddToList}>
                <div>
                  <label
                    className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-zinc-500"
                    htmlFor="nomination-position"
                  >
                    Position
                  </label>
                  <select
                    id="nomination-position"
                    className="input-app"
                    value={positionId}
                    onChange={(e) => setPositionId(e.target.value)}
                    required
                    disabled={submitting}
                  >
                    {positions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-zinc-500"
                    htmlFor="nominee-name"
                  >
                    Nominee full name
                  </label>
                  <input
                    id="nominee-name"
                    type="text"
                    className="input-app"
                    value={nomineeName}
                    onChange={(e) => setNomineeName(e.target.value)}
                    placeholder="e.g. Jane Doe"
                    required
                    autoComplete="name"
                    disabled={submitting}
                  />
                </div>
                <button type="submit" disabled={submitting} className="btn-primary w-full">
                  Add to my list
                </button>
                <p className="text-xs text-zinc-500">
                  Use the form again to add more. Remove any line below if you change your mind.
                </p>
              </form>

              {pendingNominations.length > 0 ? (
                <div className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50/80 p-4">
                  <div className="space-y-1">
                    <h2 className="text-sm font-bold text-zinc-900">Ready to send</h2>
                    <p className="text-sm text-zinc-600">
                      These nominations will be recorded when you submit. Need more? Fill the form
                      above and add another. When you are finished, submit the full list.
                    </p>
                  </div>
                  <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white">
                    {pendingNominations.map((p) => (
                      <li
                        key={p.key}
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm"
                      >
                        <div className="min-w-0">
                          <span className="font-medium text-zinc-900">{p.nominee_full_name}</span>
                          <span className="text-zinc-500"> — </span>
                          <span className="text-zinc-700">{p.position_name}</span>
                        </div>
                        <button
                          type="button"
                          className="shrink-0 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                          disabled={submitting}
                          onClick={() => handleRemovePending(p.key)}
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    disabled={submitting}
                    className="btn-primary w-full"
                    onClick={() => void handleSubmitAll()}
                  >
                    {submitting
                      ? 'Submitting…'
                      : `Submit all nominations (${pendingNominations.length})`}
                  </button>
                </div>
              ) : (
                <p className="text-sm text-zinc-500">
                  Your list is empty. Add at least one nomination using the form above.
                </p>
              )}
            </div>
          )}

          {success ? (
            <p className="text-sm font-medium text-mint-800">
              Thank you — your nominations were received.
            </p>
          ) : null}
          {error ? <p className="text-sm font-medium text-red-700">{error}</p> : null}
        </div>

        <AppCreditFooter className="mt-8" />
      </div>
      </div>
    </div>
  )
}
