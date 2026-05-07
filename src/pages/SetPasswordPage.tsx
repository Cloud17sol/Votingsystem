import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AppCreditFooter } from '../components/AppCreditFooter'
import { AppTopbar } from '../components/AppTopbar'
import { completeAuthenticatedMemberRouting } from '../lib/completeAuthenticatedMemberRouting'
import { supabase } from '../lib/supabase'

export function SetPasswordPage() {
  const navigate = useNavigate()
  const [checking, setChecking] = useState(true)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function ensureCanSetPassword() {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (cancelled) return

      if (!session?.user?.email?.trim()) {
        navigate('/login', { replace: true })
        return
      }

      const email = session.user.email.trim().toLowerCase()
      const { data: member, error: memberError } = await supabase
        .from('members')
        .select('password_set')
        .ilike('email', email)
        .maybeSingle()

      if (cancelled) return

      if (memberError || !member) {
        await supabase.auth.signOut()
        navigate('/login', { replace: true })
        return
      }

      if (member.password_set) {
        const result = await completeAuthenticatedMemberRouting(navigate)
        if (!cancelled && result.errorMessage) {
          setError(result.errorMessage)
        }
        return
      }

      setChecking(false)
    }

    void ensureCanSetPassword()
    return () => {
      cancelled = true
    }
  }, [navigate])

  async function handleSetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')

    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setSubmitting(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    if (updateError) {
      setSubmitting(false)
      setError(updateError.message)
      return
    }

    const { error: rpcError } = await supabase.rpc('mark_member_password_set')
    if (rpcError) {
      setSubmitting(false)
      setError(rpcError.message)
      return
    }

    const result = await completeAuthenticatedMemberRouting(navigate)
    setSubmitting(false)
    if (result.errorMessage) {
      setError(result.errorMessage)
    }
  }

  if (checking) {
    return (
      <div className="flex min-h-screen flex-col bg-page">
        <AppTopbar />
        <div className="flex flex-1 items-center justify-center px-4">
          <p className="text-sm text-zinc-600">Preparing your account…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-page">
      <AppTopbar />
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-10">
        <div className="card-app w-full max-w-md space-y-5 p-8">
          <div className="flex flex-wrap gap-2 border-b border-zinc-200 pb-4">
            <span className="nav-tab nav-tab-active">Set password</span>
            <Link to="/nominations" className="nav-tab nav-tab-inactive no-underline">
              Nominations
            </Link>
          </div>
          <div className="space-y-1">
            <h2 className="text-xl font-bold tracking-tight text-zinc-900">Create your password</h2>
            <p className="text-sm text-zinc-500">
              You verified your email. Choose a password you will use to sign in next time.
            </p>
          </div>

          <form className="space-y-4" onSubmit={(e) => void handleSetPassword(e)}>
            <div>
              <label
                className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-zinc-500"
                htmlFor="new-password"
              >
                Password
              </label>
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-app"
                disabled={submitting}
              />
            </div>
            <div>
              <label
                className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-zinc-500"
                htmlFor="confirm-password"
              >
                Confirm password
              </label>
              <input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="input-app"
                disabled={submitting}
              />
            </div>
            <button type="submit" disabled={submitting} className="btn-primary w-full">
              {submitting ? 'Saving…' : 'Save password and continue'}
            </button>
          </form>

          {error ? <p className="text-sm font-medium text-red-700">{error}</p> : null}
        </div>
        <AppCreditFooter className="mt-8 w-full max-w-md" />
      </div>
    </div>
  )
}
