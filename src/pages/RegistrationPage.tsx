import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AppCreditFooter } from '../components/AppCreditFooter'
import { AppTopbar } from '../components/AppTopbar'
import { GridBackground } from '../components/GridBackground'
import { PublicNotificationsPanel } from '../components/PublicNotificationsPanel'
import { supabase } from '../lib/supabase'

type SubmitResult = {
  ok?: boolean
  error?: string
}

export function RegistrationPage() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setLoading(true)

    const { data, error: rpcError } = await supabase.rpc('submit_member_registration_request', {
      p_full_name: fullName.trim(),
      p_email: email.trim().toLowerCase(),
      p_note: note.trim() || null,
    })

    setLoading(false)

    if (rpcError) {
      setError(rpcError.message || 'Unable to submit registration right now.')
      return
    }

    const result = data as SubmitResult | null
    if (!result?.ok) {
      setError(result?.error || 'Unable to submit registration right now.')
      return
    }

    setSubmitted(true)
  }

  return (
    <div className="relative flex min-h-screen flex-col bg-page">
      <GridBackground />
      <div className="relative z-10 flex min-h-screen flex-col">
        <AppTopbar />
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-10">
          <PublicNotificationsPanel />
          <div className="card-app w-full max-w-md space-y-5 p-8">
            <div className="flex flex-wrap gap-2 border-b border-zinc-200 pb-4">
              <Link to="/login" className="nav-tab nav-tab-inactive no-underline">
                Sign in
              </Link>
              <span className="nav-tab nav-tab-active">Register</span>
              <Link to="/nominations" className="nav-tab nav-tab-inactive no-underline">
                Nominations
              </Link>
            </div>

            <div className="space-y-1">
              <h2 className="text-xl font-bold tracking-tight text-zinc-900">Voter&apos;s Registration</h2>
              <p className="text-sm text-zinc-500">
                Submit your details for admin review. Once approved, you can sign in with this email.
              </p>
            </div>

            {submitted ? (
              <div className="space-y-4">
                <div className="rounded-2xl border border-mint-700/20 bg-mint-50/80 px-4 py-3">
                  <p className="text-sm font-medium text-mint-900">Request submitted</p>
                  <p className="mt-1 text-sm text-mint-800">
                    The election committee will review your registration. You will be NOTIFIED and be
                    able to sign in after approval.
                  </p>
                </div>
                <Link to="/login" className="btn-primary inline-flex w-full no-underline">
                  Back to sign in
                </Link>
              </div>
            ) : (
              <form className="space-y-4" onSubmit={(e) => void handleSubmit(e)}>
                <div>
                  <label
                    className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-zinc-500"
                    htmlFor="reg-full-name"
                  >
                    Full name
                  </label>
                  <p className="mb-2 text-xs text-zinc-500">
                    Kindly use your full name for easy identification (nickname or first name only
                    will be rejected).
                  </p>
                  <input
                    id="reg-full-name"
                    type="text"
                    autoComplete="name"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="input-app"
                    disabled={loading}
                    placeholder="e.g. Jane Doe"
                  />
                </div>
                <div>
                  <label
                    className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-zinc-500"
                    htmlFor="reg-email"
                  >
                    Email
                  </label>
                  <input
                    id="reg-email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="input-app"
                    disabled={loading}
                    placeholder="name@example.com"
                  />
                </div>
                <div>
                  <label
                    className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-zinc-500"
                    htmlFor="reg-note"
                  >
                    Note (optional)
                  </label>
                  <textarea
                    id="reg-note"
                    rows={3}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    className="input-app resize-y"
                    disabled={loading}
                    placeholder="Class year, alumni chapter, or other details"
                  />
                </div>
                {error ? <p className="text-sm font-medium text-red-700">{error}</p> : null}
                <button type="submit" disabled={loading} className="btn-primary w-full">
                  {loading ? 'Submitting…' : 'Submit request'}
                </button>
              </form>
            )}
          </div>
          <AppCreditFooter className="mt-2 w-full max-w-md" />
        </div>
      </div>
    </div>
  )
}
